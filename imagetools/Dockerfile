FROM python:3.11-slim

# ORT_DISABLE_TELEMETRY: onnxruntime 1.31 sends usage telemetry to Microsoft unless told not to.
ENV PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    IMAGETOOLS_MODELS=/app/models \
    ORT_DISABLE_TELEMETRY=1

RUN pip install --no-cache-dir onnxruntime==1.31.0 numpy==2.4.6 pillow==12.3.0 scipy==1.17.1

WORKDIR /app
# ISNet (DIS, Apache-2.0) from the rembg release (md5 fc16ebd8b0c10d971d3513d564d01e29 as published), pinned by sha256.
ADD --checksum=sha256:60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a \
    https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx \
    /app/models/isnet-general-use.onnx
# Real-ESRGAN general x4v3 (BSD-3), its weak-denoise twin blended 50/50, exported to ONNX.
COPY models/realesr-general-x4v3-dn05.onnx /app/models/
COPY pipeline.py server.py /app/

RUN chmod 644 /app/models/*.onnx
USER nobody
EXPOSE 8000
CMD ["python", "/app/server.py"]
