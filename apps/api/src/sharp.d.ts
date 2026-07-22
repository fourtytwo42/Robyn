declare module "sharp" {
  type Metadata = {
    format?: string;
    width?: number;
    height?: number;
    pages?: number;
  };

  type Sharp = {
    metadata(): Promise<Metadata>;
    rotate(): Sharp;
    resize(
      width: number,
      height: number,
      options: { fit: "cover"; position: "centre" },
    ): Sharp;
    webp(options: { quality: number; effort: number }): Sharp;
    toBuffer(): Promise<Buffer>;
  };

  type SharpOptions = {
    animated: boolean;
    failOn: "error";
    limitInputPixels: number;
    sequentialRead: boolean;
  };

  const sharp: (input: Buffer, options: SharpOptions) => Sharp;
  export default sharp;
}
