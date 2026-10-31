import { Platform } from "react-native";
import { Directory, File } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { api } from "./api";
import { exportFile, safeDownloadName } from "./export-file";
import type { Attachment } from "./contracts";

export async function saveAttachment(
  a: Attachment,
  load: () => Promise<string>,
) {
  const token = api.token;
  const name = safeDownloadName(a.name);
  return exportFile<File>({
    current: () => !!token && api.token === token,
    load,
    select: async () => {
      if (Platform.OS === "android") {
        const result = await IntentLauncher.startActivityAsync(
          "android.intent.action.CREATE_DOCUMENT",
          {
            category: "android.intent.category.OPENABLE",
            type: a.mime || "application/octet-stream",
            extra: { "android.intent.extra.TITLE": name },
          },
        );
        if (result.resultCode === IntentLauncher.ResultCode.Canceled)
          return null;
        if (
          result.resultCode !== IntentLauncher.ResultCode.Success ||
          !result.data
        )
          throw new Error("Could not open the save location. Please retry.");
        return new File(result.data);
      }
      if (Platform.OS === "ios") {
        let directory: Directory;
        try {
          directory = await Directory.pickDirectoryAsync();
        } catch (e) {
          if ((e as { code?: string }).code === "ERR_FILE_PICKING_CANCELLED")
            return null;
          throw e;
        }
        // Never replace an existing file in a chosen folder.
        let destination = new File(directory, name);
        let suffix = 1;
        const dot = name.lastIndexOf(".");
        while (destination.exists) {
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const extension = dot > 0 ? name.slice(dot) : "";
          destination = new File(
            directory,
            `${stem} (${suffix++})${extension}`,
          );
        }
        return destination;
      }
      throw new Error(
        "Saving attachments is available in the Android and iOS app.",
      );
    },
    copy: async (source, destination) => {
      if (Platform.OS === "android") {
        // Write into the document created by Save as; copying with overwrite
        // would delete and recreate a SAF document, invalidating its URI.
        await new File(source)
          .readableStream()
          .pipeTo(destination.writableStream());
      } else {
        await new File(source).copy(destination);
      }
    },
  });
}
