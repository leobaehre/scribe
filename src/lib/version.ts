/** Version of this build, from package.json. */
export const VERSION = __APP_VERSION__;
/** Git commit the build comes from, e.g. "83fc47d" ("-dirty" with uncommitted changes). */
export const COMMIT = __APP_COMMIT__;
/** True for `npm run tauri dev` and `tauri build --debug`. */
export const DEBUG = __APP_DEBUG__;
