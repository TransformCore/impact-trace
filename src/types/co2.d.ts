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
            dataCenterOperationalCO2e?: number;
            networkOperationalCO2e?: number;
            consumerDeviceOperationalCO2e?: number;
            dataCenterEmbodiedCO2e?: number;
            networkEmbodiedCO2e?: number;
            consumerDeviceEmbodiedCO2e?: number;
            totalOperationalCO2e?: number;
            totalEmbodiedCO2e?: number;
          };
      green: boolean;
      variables: Record<string, unknown>;
    };
  }
}
