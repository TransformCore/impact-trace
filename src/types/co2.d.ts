declare module '@tgwf/co2' {
  export class co2 {
    constructor(options?: {
      model?: 'swd' | '1byte';
      version?: 3 | 4;
      results?: 'segment';
      rating?: boolean;
    });

    perByteTrace(
      bytes: number,
      green?: boolean,
      options?: Record<string, unknown>,
    ): {
      co2:
        | number
        | {
            total?: number;
            dataCenterCO2e?: number;
            networkCO2e?: number;
            consumerDeviceCO2e?: number;
          };
      green: boolean;
      variables: Record<string, unknown>;
    };
  }
}
