import path from "node:path";

import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

import {
  SIMILARITY_EMBEDDING_DIMENSIONS,
  SIMILARITY_MODEL_DTYPE,
  SIMILARITY_MODEL_ID,
  SIMILARITY_MODEL_REVISION
} from "./constants.js";

export interface SimilarityEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface LocalSimilarityEmbedderOptions {
  allowRemoteModels: boolean;
  cacheDirectory: string;
}

export class LocalSimilarityEmbedder implements SimilarityEmbedder {
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly options: LocalSimilarityEmbedderOptions) {}

  async initialize(): Promise<void> {
    await this.getExtractor();
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await this.getExtractor();
    const output = await extractor(texts, {
      normalize: true,
      pooling: "mean"
    });
    const values = output.tolist() as unknown;

    if (!Array.isArray(values)) {
      throw new Error("Embedding model returned an unexpected tensor.");
    }

    const vectors = values.map((value) => validateVector(value));

    if (vectors.length !== texts.length) {
      throw new Error(
        `Embedding model returned ${vectors.length} vectors for ${texts.length} texts.`
      );
    }

    return vectors;
  }

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      env.cacheDir = this.options.cacheDirectory;
      env.allowRemoteModels = this.options.allowRemoteModels;
      this.extractorPromise = this.options.allowRemoteModels
        ? pipeline("feature-extraction", SIMILARITY_MODEL_ID, {
          cache_dir: this.options.cacheDirectory,
          dtype: SIMILARITY_MODEL_DTYPE,
          local_files_only: false,
          revision: SIMILARITY_MODEL_REVISION
        })
        : pipeline("feature-extraction", this.localModelDirectory(), {
            dtype: SIMILARITY_MODEL_DTYPE,
            local_files_only: true
          });
    }

    return this.extractorPromise;
  }

  private localModelDirectory(): string {
    return path.resolve(
      this.options.cacheDirectory,
      ...SIMILARITY_MODEL_ID.split("/"),
      SIMILARITY_MODEL_REVISION
    );
  }
}

function validateVector(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== SIMILARITY_EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `Embedding model must return ${SIMILARITY_EMBEDDING_DIMENSIONS} dimensions.`
    );
  }

  const vector = value.map((entry) => Number(entry));

  if (vector.some((entry) => !Number.isFinite(entry))) {
    throw new Error("Embedding model returned a non-finite vector value.");
  }

  return vector;
}
