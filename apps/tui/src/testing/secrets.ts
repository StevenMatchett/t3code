export interface SecretFixture {
  readonly name: string;
  readonly value: string;
}

export interface SecretScanSource {
  readonly name: string;
  readonly content: string;
}

export interface SecretScanOptions {
  readonly secrets: readonly SecretFixture[];
  readonly sources: readonly SecretScanSource[];
}

export class SecretExposureError extends Error {
  readonly secretName: string;
  readonly sourceName: string;

  constructor(secretName: string, sourceName: string) {
    super(`Secret fixture "${secretName}" was found in "${sourceName}"`);
    this.name = "SecretExposureError";
    this.secretName = secretName;
    this.sourceName = sourceName;
  }
}

/** Scans captured frames and logs without repeating a matched secret in the error. */
export function assertNoSecrets({ secrets, sources }: SecretScanOptions): void {
  for (const secret of secrets) {
    if (secret.value.length === 0) {
      throw new TypeError(`Secret fixture "${secret.name}" must not be empty`);
    }

    for (const source of sources) {
      if (source.content.includes(secret.value)) {
        throw new SecretExposureError(secret.name, source.name);
      }
    }
  }
}
