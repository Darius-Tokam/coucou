// What Settings → Mascot says when an import fails (codes from src-tauri/src/mascot.rs).

import { t } from "../i18n/i18n";

export function importErrorText(code: string): string {
  if (code.startsWith("missing_file:")) {
    return t("A file of the export is missing: {file}", { file: code.slice("missing_file:".length) });
  }
  switch (code) {
    case "not_an_export":
      return t("This folder doesn't hold a MascotForge export.");
    case "bad_manifest":
      return t("The export's manifest.json can't be read.");
    case "wrong_version":
      return t("This export is too old. Export it again from MascotForge.");
    default:
      return t("Coucou couldn't copy the folder.");
  }
}
