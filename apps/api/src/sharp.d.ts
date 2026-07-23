declare module "sharp" {
  type Metadata = {
    format?: string;
    width?: number;
    height?: number;
    pages?: number;
    hasAlpha?: boolean;
  };

  type Sharp = {
    metadata(): Promise<Metadata>;
    clone(): Sharp;
    rotate(): Sharp;
    resize(
      width: number,
      height: number,
      options: { fit: "cover"; position: "centre" },
    ): Sharp;
    webp(options: { quality: number; effort: number }): Sharp;
    png(options: {
      compressionLevel: number;
      adaptiveFiltering: boolean;
      palette: boolean;
    }): Sharp;
    toBuffer(): Promise<Buffer>;
  };

  type SharpOptions = {
    animated: boolean;
    failOn: "error";
    limitInputPixels: number;
    sequentialRead: boolean;
  };

  type CacheResult = {
    memory: { current: number; high: number; max: number };
    files: { current: number; max: number };
    items: { current: number; max: number };
  };

  type SharpConstructor = {
    (input: Buffer, options: SharpOptions): Sharp;
    cache(enable?: boolean): CacheResult;
    concurrency(threads?: number): number;
  };

  const sharp: SharpConstructor;
  export default sharp;
}
