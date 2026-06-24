import { isEnabled, type FeatureFlag } from "@app/lib";

const flag: FeatureFlag = {
  name: "new-dashboard",
  enabled: true
};

console.log(isEnabled(flag));
