export type { DataAdapter } from "./types";
export { createMockAdapter } from "./mockAdapter";
export { createCsvAdapter, type CsvAdapter, type CsvAdapterInput } from "./csvAdapter";
export {
  createAkshareLocalAdapter,
  getAkshareLocalCacheStatus,
  readAkshareImportReport,
  readAkshareFetchStatus,
  inferBoardType,
  type AkshareLocalAdapter,
  type AkshareImportReport,
  type AkshareFetchStatus,
  type AkshareFetchStatusEntry,
  type AkshareLocalCacheStatus,
} from "./akshareLocalAdapter";
export {
  createBaostockLocalAdapter,
  getBaostockLocalCacheStatus,
  readBaostockImportReport,
  readBaostockFetchStatus,
  type BaostockLocalAdapter,
  type BaostockImportReport,
  type BaostockFetchStatus,
  type BaostockFetchStatusEntry,
  type BaostockCacheStatus,
} from "./baostockLocalAdapter";
export {
  createAkshareAdapter,
  type AkshareAdapterConfig,
} from "./akshareAdapter";
export {
  createTushareAdapter,
  type TushareAdapterConfig,
} from "./tushareAdapter";

export type DataSourceId = "mock" | "akshareLocal" | "baostockLocal";
