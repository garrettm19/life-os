const { withEntitlementsPlist } = require('expo/config-plugins');

// expo-widgets adds aps-environment even when its push support is disabled; Life OS uses no push.
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
