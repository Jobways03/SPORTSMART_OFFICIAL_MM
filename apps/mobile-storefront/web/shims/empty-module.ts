// Empty module — used as the resolution target for native-only RN
// internal paths (codegenNativeComponent, AppContainer, etc.) that
// some RN libraries reference for Fabric / iOS / Android builds but
// don't matter on web. Vite's resolve.alias points the offending
// imports here so the bundler doesn't choke; runtime never touches
// the imported symbols on web because the surrounding code is gated.
export default {};
export const codegenNativeComponent = () => null;
export const codegenNativeCommands = () => null;
