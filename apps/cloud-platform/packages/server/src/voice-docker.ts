import Docker from "dockerode";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const VOICE_CONTAINER_NAME = "lotaru-voice-sidecar";
export const VOICE_CPU_IMAGE = "lotaru-voice:cpu";
export const VOICE_CACHE_VOLUME = "lotaru-whisper-cache";
export const DOCKER_DESKTOP_REQUIRED =
  "Docker Desktop is required for Listen. Start Docker, then press Listen again.";

const dockerErrorSchema = z.object({
  statusCode: z.number(),
});

export type VoiceWhisperDevice = "cpu" | "cuda";

export type VoiceDockerEnsureResult = {
  startedByUs: boolean;
};

export function voiceWhisperDevice(platform: string, nvidiaRuntime: boolean): VoiceWhisperDevice {
  if (platform === "darwin") {
    return "cpu";
  }
  if (nvidiaRuntime === true) {
    return "cuda";
  }
  return "cpu";
}

export function voiceCpuBuildPlatform(nodeArch: string): string {
  if (nodeArch === "arm64") {
    return "linux/arm64";
  }
  return "linux/amd64";
}

export function voiceSidecarContextDir(hereDir: string): string {
  const candidate = join(hereDir, "..", "..", "..", "voice-sidecar");
  if (existsSync(join(candidate, "Dockerfile.cpu")) !== true) {
    throw new Error("Voice engine files are missing. Reinstall with npx -y @umudik/lotaru@latest");
  }
  if (existsSync(join(candidate, "server.py")) !== true) {
    throw new Error("Voice engine files are missing. Reinstall with npx -y @umudik/lotaru@latest");
  }
  if (existsSync(join(candidate, "requirements.txt")) !== true) {
    throw new Error("Voice engine files are missing. Reinstall with npx -y @umudik/lotaru@latest");
  }
  if (existsSync(join(candidate, "repeat_filter.py")) !== true) {
    throw new Error("Voice engine files are missing. Reinstall with npx -y @umudik/lotaru@latest");
  }
  return candidate;
}

export function voiceSidecarHereDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export function voiceCpuImageListFilters(): string {
  const payload: { reference: string[] } = { reference: [VOICE_CPU_IMAGE] };
  const encoded = JSON.stringify(payload);
  if (encoded.includes("reference") !== true) {
    throw new Error("voice image filter must use the reference key");
  }
  if (encoded.includes(VOICE_CPU_IMAGE) !== true) {
    throw new Error("voice image filter must name the CPU image");
  }
  return encoded;
}

export function containerWhisperDevice(envLines: readonly string[]): VoiceWhisperDevice {
  for (const line of envLines) {
    if (line === "LOTARU_WHISPER_DEVICE=cuda") {
      return "cuda";
    }
  }
  for (const line of envLines) {
    if (line === "LOTARU_WHISPER_DEVICE=cpu") {
      return "cpu";
    }
  }
  return "cpu";
}

function dockerStatusCode(failure: unknown): number {
  const parsed = dockerErrorSchema.safeParse(failure);
  if (parsed.success !== true) {
    return 0;
  }
  return parsed.data.statusCode;
}

async function inspectNamed(
  docker: Docker,
  name: string,
): Promise<Docker.ContainerInspectInfo | false> {
  try {
    const info = await docker.getContainer(name).inspect();
    return info;
  } catch (failure) {
    if (dockerStatusCode(failure) === 404) {
      return false;
    }
    throw failure;
  }
}

async function connectDocker(): Promise<Docker> {
  const docker = new Docker();
  try {
    await docker.ping();
    return docker;
  } catch {
    throw new Error(DOCKER_DESKTOP_REQUIRED);
  }
}

async function ensureCacheVolume(docker: Docker): Promise<void> {
  try {
    await docker.createVolume({ Name: VOICE_CACHE_VOLUME });
  } catch (failure) {
    if (dockerStatusCode(failure) === 409) {
      return;
    }
    throw failure;
  }
}

async function cpuImagePresent(docker: Docker): Promise<boolean> {
  const images = await docker.listImages({
    filters: voiceCpuImageListFilters(),
  });
  if (images.length > 0) {
    return true;
  }
  return false;
}

async function buildCpuImage(docker: Docker, contextDir: string, nodeArch: string): Promise<void> {
  const stream = await docker.buildImage(
    {
      context: contextDir,
      src: ["Dockerfile.cpu", "requirements.txt", "server.py", "repeat_filter.py"],
    },
    {
      t: VOICE_CPU_IMAGE,
      dockerfile: "Dockerfile.cpu",
      platform: voiceCpuBuildPlatform(nodeArch),
    },
  );
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function createCpuContainer(docker: Docker): Promise<void> {
  await docker.createContainer({
    name: VOICE_CONTAINER_NAME,
    Image: VOICE_CPU_IMAGE,
    Env: [
      "LOTARU_WHISPER_DEVICE=cpu",
      "LOTARU_WHISPER_COMPUTE=int8",
      "LOTARU_WHISPER_MODEL=small",
      "LOTARU_WHISPER_LANGUAGE=tr",
    ],
    ExposedPorts: {
      "18765/tcp": {},
    },
    HostConfig: {
      PortBindings: {
        "18765/tcp": [{ HostIp: "127.0.0.1", HostPort: "18765" }],
      },
      Binds: [`${VOICE_CACHE_VOLUME}:/root/.cache`],
      RestartPolicy: { Name: "no" },
    },
  });
}

let ownedByThisProcess = false;

export function voiceDockerOwned(): boolean {
  return ownedByThisProcess;
}

export function markVoiceDockerOwned(owned: boolean): void {
  ownedByThisProcess = owned;
}

function inspectEnvLines(info: Docker.ContainerInspectInfo): readonly string[] {
  const env = info.Config.Env;
  if (Array.isArray(env) !== true) {
    return [];
  }
  const lines: string[] = [];
  const envLineSchema = z.string();
  for (const entry of env) {
    const parsed = envLineSchema.safeParse(entry);
    if (parsed.success === true) {
      lines.push(parsed.data);
    }
  }
  return lines;
}

async function dropCudaContainerOnMac(
  docker: Docker,
  existing: Docker.ContainerInspectInfo,
): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  if (containerWhisperDevice(inspectEnvLines(existing)) !== "cuda") {
    return false;
  }
  await docker.getContainer(VOICE_CONTAINER_NAME).remove({ force: true });
  return true;
}

export async function ensureVoiceSidecarContainer(): Promise<VoiceDockerEnsureResult> {
  const docker = await connectDocker();
  const existing = await inspectNamed(docker, VOICE_CONTAINER_NAME);
  if (existing !== false) {
    const droppedCuda = await dropCudaContainerOnMac(docker, existing);
    if (droppedCuda !== true) {
      if (existing.State.Running === true) {
        return { startedByUs: false };
      }
      await docker.getContainer(VOICE_CONTAINER_NAME).start();
      ownedByThisProcess = true;
      return { startedByUs: true };
    }
  }
  const contextDir = voiceSidecarContextDir(voiceSidecarHereDir());
  const hasImage = await cpuImagePresent(docker);
  if (hasImage !== true) {
    await buildCpuImage(docker, contextDir, process.arch);
  }
  await ensureCacheVolume(docker);
  await createCpuContainer(docker);
  await docker.getContainer(VOICE_CONTAINER_NAME).start();
  ownedByThisProcess = true;
  return { startedByUs: true };
}

export async function stopOwnedVoiceSidecarContainer(): Promise<void> {
  if (ownedByThisProcess !== true) {
    return;
  }
  try {
    const docker = await connectDocker();
    const existing = await inspectNamed(docker, VOICE_CONTAINER_NAME);
    if (existing === false) {
      ownedByThisProcess = false;
      return;
    }
    if (existing.State.Running === true) {
      await docker.getContainer(VOICE_CONTAINER_NAME).stop({ t: 8 });
    }
  } catch {
    ownedByThisProcess = false;
    return;
  }
  ownedByThisProcess = false;
}
