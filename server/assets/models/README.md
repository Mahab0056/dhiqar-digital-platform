# Face models (InsightFace `buffalo_sc`, MIT-licensed model pack)

- `det_500m.onnx` — SCRFD-500M face detector with 5 landmarks (2.5 MB)
- `w600k_mbf.onnx` — MobileFaceNet ArcFace embedding (512-d, trained on WebFace600K, 13 MB)

Source: https://github.com/deepinsight/insightface/releases/tag/v0.7 (`buffalo_sc.zip`).
Runs on CPU through `onnxruntime-node`; no images ever leave the server.
