export interface RatedConversionContext {
  owner: number | null;
  jobId: number | null;
  uploadId: number | null;
}

export interface ResolvedRatedConversion {
  jobId: number | null;
  uploadId: number | null;
}

export interface IRatedConversionResolver {
  resolve(context: RatedConversionContext): Promise<ResolvedRatedConversion>;
}

export interface IJobOwnershipChecker {
  existsByIdAndOwner(id: number, owner: string): Promise<boolean>;
}

export interface IUploadOwnershipChecker {
  findByIdAndOwner(id: number, owner: number): Promise<unknown | null>;
}

export class ResolveRatedConversionUseCase implements IRatedConversionResolver {
  constructor(
    private readonly jobs: IJobOwnershipChecker,
    private readonly uploads: IUploadOwnershipChecker
  ) {}

  async resolve({
    owner,
    jobId,
    uploadId,
  }: RatedConversionContext): Promise<ResolvedRatedConversion> {
    if (owner == null) {
      return { jobId: null, uploadId: null };
    }
    return {
      jobId: await this.resolveJobId(owner, jobId),
      uploadId: await this.resolveUploadId(owner, uploadId),
    };
  }

  private async resolveJobId(
    owner: number,
    jobId: number | null
  ): Promise<number | null> {
    if (jobId == null) {
      return null;
    }
    const owned = await this.jobs.existsByIdAndOwner(jobId, String(owner));
    return owned ? jobId : null;
  }

  private async resolveUploadId(
    owner: number,
    uploadId: number | null
  ): Promise<number | null> {
    if (uploadId == null) {
      return null;
    }
    const upload = await this.uploads.findByIdAndOwner(uploadId, owner);
    return upload != null ? uploadId : null;
  }
}
