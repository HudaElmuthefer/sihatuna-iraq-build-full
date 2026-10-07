#!/usr/bin/env python3
# backend/services/ocr/paddle_ocr_runner.py
#
# Standalone OCR worker script, invoked as a child process from
# backend/agents/ocrAgent.js (one process per OCR job — see that file for why
# a subprocess-per-job instead of a long-running Python daemon). Reads a
# base64-encoded image on stdin, runs PaddleOCR, and prints a single JSON
# line to stdout: {"text": "...", "avgConfidence": 0.0-1.0, "lines": [...]}.
# On any failure, prints the error to stderr and exits non-zero — the Node
# caller treats that as "OCR unavailable" (fail-open, same philosophy as
# every other AI/optional dependency in this project).
#
# Language: defaults to Arabic ('ar') via the OCR_LANG env var — this is an
# Iraqi hospital's primary invoice language. PaddleOCR loads one recognition
# model per language; it does not merge Arabic+English+digits in a single
# pass as well as a multimodal vision model would. This is a known quality
# limitation (see ocrAgent.js comment) — the caller also sends the original
# image straight to Gemini vision as a stronger authoritative source, using
# this OCR text only as extra context, not as the sole input.
import base64
import contextlib
import json
import sys

# ── حماية: ترميز stdout/stderr — عربي، لا الترميز الافتراضي بويندوز ─────────
# تأكّدنا فعلياً: بويندوز، لو stdout مُعاد توجيهه (redirect لملف/عملية أخرى،
# بالضبط حالة استدعاء agents/ocrAgent.js)، بايثون يفترض ترميز الصفحة الرمزية
# القديمة للنظام (cp1252 هنا) بدل UTF-8 — cp1252 لا يستطيع ترميز حروف عربية
# إطلاقاً، فتفشل عملية print() نفسها بـUnicodeEncodeError بمجرد وجود أي نص
# عربي بالنتيجة (بالضبط ما سنطبعه دائماً، هذا كل معنى الملف). لينكس/Docker
# افتراضياً UTF-8 غالباً فلا يظهر هذا هناك عادةً، لكن فرضه صراحة هنا يضمن
# نفس السلوك بأي بيئة تشغيل بدل الاعتماد على إعداد النظام الضمني.
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ── حماية: PaddleOCR يطبع أسطراً غير JSON إلى stdout مباشرة (لا stderr) ──────
# تأكّدنا فعلياً بالاختبار: تحميل نموذج لغة لأول مرة (قبل تخزينه مؤقتاً
# محلياً) يطبع سطر "download <url> to <path>" على stdout عبر print() عادي —
# بعكس أشرطة تقدّم tqdm نفسها (تذهب لـstderr صح). لو صار هذا وسط الإخراج
# الذي يقرأه agents/ocrAgent.js (يتوقّع JSON خالص على stdout)، يفشل تحليل
# JSON فوراً. الحل: نُحوِّل أي طباعة تصدر أثناء تحميل/تشغيل PaddleOCR نفسه
# لـstderr مؤقتاً، ونطبع نتيجتنا فقط بعد استعادة stdout الحقيقي — يضمن
# نتيجة نظيفة بغض النظر عمّا تطبعه المكتبة داخلياً. (احتياط إضافي؛ الحل
# الأساسي هو تحميل النماذج مسبقاً وقت بناء صورة Docker — راجع Dockerfile.)
@contextlib.contextmanager
def stdout_redirected_to_stderr():
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = real_stdout

def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)

def main():
    raw_b64 = sys.stdin.read().strip()
    if not raw_b64:
        fail('لا توجد بيانات صورة على stdin')

    try:
        image_bytes = base64.b64decode(raw_b64)
    except Exception as err:
        fail(f'فشل فك ترميز base64: {err}')

    try:
        import numpy as np
        import cv2
        from paddleocr import PaddleOCR
    except ImportError as err:
        fail(f'حزم PaddleOCR غير مثبَّتة: {err} — راجع backend/services/ocr/requirements.txt')

    image_array = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_array is None:
        fail('تعذّرت قراءة الصورة — تنسيق غير مدعوم أو ملف تالف')

    import os
    lang = os.environ.get('OCR_LANG', 'ar')

    try:
        # use_angle_cls: يصحّح دوران الصورة (شائع بصور ملتقطة بالكاميرا لا
        # الماسح الضوئي) قبل القراءة. show_log=False يمنع سجلات PaddleOCR
        # المعتادة (لا يمنع طباعة تحميل النموذج نفسه — راجع
        # stdout_redirected_to_stderr أعلاه للحماية الفعلية من هذه الحالة).
        with stdout_redirected_to_stderr():
            ocr = PaddleOCR(use_angle_cls=True, lang=lang, show_log=False)
            result = ocr.ocr(image_array, cls=True)
    except Exception as err:
        fail(f'فشل تشغيل PaddleOCR: {err}')

    lines = []
    # result هو قائمة بنتيجة كل صورة مُمرَّرة — صورة واحدة هنا فقط، فنأخذ
    # result[0]. قد تكون None لو الصورة لا تحتوي أي نص مكتشَف إطلاقاً (فاتورة
    # فارغة أو صورة سيئة جداً) — نتعامل معها كنتيجة فارغة، لا كخطأ.
    page = result[0] if result else None
    if page:
        for box, (text, confidence) in page:
            lines.append({'text': text, 'confidence': round(float(confidence), 4)})

    full_text = '\n'.join(l['text'] for l in lines)
    avg_confidence = round(sum(l['confidence'] for l in lines) / len(lines), 4) if lines else 0.0

    print(json.dumps({'text': full_text, 'avgConfidence': avg_confidence, 'lines': lines}, ensure_ascii=False))

if __name__ == '__main__':
    main()
