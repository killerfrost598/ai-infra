from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ProbeResult:
    driver_version: str | None = None
    cuda_runtime_host: str | None = None
    gpus: list[dict] = field(default_factory=list)
    nvlink_topology: str | None = None
    homogeneous: bool = True
    docker_present: bool = False
    nvidia_container_toolkit: bool = False
    raw_outputs: dict = field(default_factory=dict)


def probe_host(ssh) -> ProbeResult:
    """Run all capability probes. Each step is wrapped in try/except — failure sets None, never raises."""
    result = ProbeResult()

    # 1. nvidia-smi GPU query
    cmd = (
        "nvidia-smi --query-gpu=name,compute_cap,memory.total,driver_version,"
        "uuid,pcie.link.gen.current,pcie.link.width.current "
        "--format=csv,noheader,nounits"
    )
    try:
        stdout, _, rc = ssh.execute(cmd)
        result.raw_outputs["nvidia_smi_query"] = stdout
        if rc == 0 and stdout.strip():
            for line in stdout.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 7:
                    try:
                        vram_mb = int(parts[2])
                    except ValueError:
                        vram_mb = 0
                    result.gpus.append({
                        "name": parts[0],
                        "cc": parts[1],
                        "vram_mb": vram_mb,
                        "vram_gb": vram_mb // 1024,
                        "driver_version": parts[3],
                        "uuid": parts[4],
                        "pcie_gen": int(parts[5]) if parts[5].isdigit() else None,
                        "pcie_width": int(parts[6]) if parts[6].isdigit() else None,
                    })
            if result.gpus:
                result.driver_version = result.gpus[0]["driver_version"]
                result.homogeneous = len({g["name"] for g in result.gpus}) == 1
    except Exception:
        pass

    # 2. nvidia-smi topology
    try:
        stdout, _, rc = ssh.execute("nvidia-smi topo -m")
        if rc == 0:
            result.nvlink_topology = stdout
            result.raw_outputs["nvidia_smi_topo"] = stdout
    except Exception:
        pass

    # 3. nvcc host toolkit version (optional)
    try:
        stdout, _, rc = ssh.execute(
            "nvcc --version 2>/dev/null | grep release | awk '{print $6}' | cut -c2-"
        )
        if rc == 0 and stdout.strip():
            result.cuda_runtime_host = stdout.strip()
            result.raw_outputs["nvcc_version"] = stdout.strip()
    except Exception:
        pass

    # 4. Docker + nvidia-container-toolkit
    try:
        _, _, rc = ssh.execute("which docker >/dev/null 2>&1")
        result.docker_present = rc == 0
        result.raw_outputs["docker_present"] = result.docker_present
        if result.docker_present:
            stdout, _, _ = ssh.execute("docker info --format '{{.Runtimes}}' 2>/dev/null")
            result.nvidia_container_toolkit = "nvidia" in (stdout or "")
            result.raw_outputs["nvidia_container_toolkit"] = result.nvidia_container_toolkit
    except Exception:
        pass

    return result
