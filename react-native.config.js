// React Native CLI config — bundle the redesign's font families (feature 009).
// Drop the static `.ttf` weights into `assets/fonts/` (Bricolage Grotesque 600/700/800;
// Public Sans 400/500/600/700/800), then run `npx react-native-asset` to link them
// (Android `assets/fonts`, iOS Info.plist `UIAppFonts`). Rebuild the app afterwards.
module.exports = {
  assets: ['./assets/fonts'],
};
