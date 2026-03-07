import { CountyTaxProvider } from "../../types";
import { anokaCountyTaxProvider } from "./anokaProvider";
import { carverCountyTaxProvider } from "./carverProvider";
import { dakotaCountyTaxProvider } from "./dakotaProvider";
import { hennepinCountyTaxProvider } from "./hennepinProvider";
import { ramseyCountyTaxProvider } from "./ramseyProvider";
import { scottCountyTaxProvider } from "./scottProvider";
import { washingtonCountyTaxProvider } from "./washingtonProvider";
import { wrightCountyTaxProvider } from "./wrightProvider";

export const metroCountyTaxProviders: CountyTaxProvider[] = [
  hennepinCountyTaxProvider,
  ramseyCountyTaxProvider,
  dakotaCountyTaxProvider,
  anokaCountyTaxProvider,
  washingtonCountyTaxProvider,
  scottCountyTaxProvider,
  carverCountyTaxProvider,
  wrightCountyTaxProvider
];

export function getMetroCountyProvider(
  county: string | null | undefined
): CountyTaxProvider | null {
  return metroCountyTaxProviders.find((provider) => provider.canHandle(county)) ?? null;
}
