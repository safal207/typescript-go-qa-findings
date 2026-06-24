export interface FeatureFlag {
  name: string;
  enabled: boolean;
}

export function isEnabled(flag: FeatureFlag): boolean {
  return flag.enabled;
}
