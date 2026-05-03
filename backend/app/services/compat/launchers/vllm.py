from __future__ import annotations


def build_launch_cmd(
    variant,
    stack_row,
    snapshot,
    mode: str,
    tp_size: int = 1,
    remote_port: int = 8000,
    hf_token: str | None = None,
) -> str:
    model = variant.hf_repo or variant.model_key
    quant_flag = (
        f"--quantization {variant.quant} "
        if variant.quant not in ("bf16", "fp16", "auto", "none", None)
        else ""
    )
    tp_flag = f"--tensor-parallel-size {tp_size} " if tp_size > 1 else ""
    hf_env = f"-e HUGGING_FACE_HUB_TOKEN={hf_token} " if hf_token and mode == "container" else ""
    safe_name = variant.model_key.replace("-", "_").replace(".", "_").replace("/", "_")

    if mode == "container":
        return (
            f"docker run -d --gpus all "
            f"-p {remote_port}:8000 "
            f"-v ~/.cache/huggingface:/root/.cache/huggingface "
            f"--name aip_vllm_{safe_name} "
            f"--restart unless-stopped "
            f"{hf_env}"
            f"{stack_row.container_image} "
            f"--model {model} "
            f"--port 8000 "
            f"--gpu-memory-utilization 0.90 "
            f"--max-model-len {variant.context_default} "
            f"{quant_flag}"
            f"{tp_flag}"
            f"--trust-remote-code"
        ).strip()

    # venv fallback
    hf_env_venv = f"HUGGING_FACE_HUB_TOKEN={hf_token} " if hf_token else ""
    return (
        f"{hf_env_venv}"
        f"nohup ~/aip_venv/bin/python -m vllm.entrypoints.openai.api_server "
        f"--model {model} "
        f"--port {remote_port} "
        f"--gpu-memory-utilization 0.90 "
        f"--max-model-len {variant.context_default} "
        f"{quant_flag}"
        f"{tp_flag}"
        f"--trust-remote-code "
        f"> /tmp/vllm_{remote_port}.log 2>&1 &"
    ).strip()
