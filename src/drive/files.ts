import type {
  RawDriveAbout,
  RawDriveFile,
  RawDriveShortcutDetails,
  RawDriveStorageQuota,
  RawDriveUser,
} from "./client";

function mapDriveUser(user: RawDriveUser | undefined): {
  display_name: string;
  email_address: string;
  me: boolean;
  permission_id: string;
  photo_link: string;
} {
  return {
    display_name: user?.displayName ?? "",
    email_address: user?.emailAddress ?? "",
    me: user?.me ?? false,
    permission_id: user?.permissionId ?? "",
    photo_link: user?.photoLink ?? "",
  };
}

function mapDriveStorageQuota(quota: RawDriveStorageQuota | undefined): {
  limit: string;
  usage: string;
  usage_in_drive: string;
  usage_in_drive_trash: string;
} {
  return {
    limit: quota?.limit ?? "",
    usage: quota?.usage ?? "",
    usage_in_drive: quota?.usageInDrive ?? "",
    usage_in_drive_trash: quota?.usageInDriveTrash ?? "",
  };
}

function mapShortcutDetails(
  details: RawDriveShortcutDetails | undefined,
): {
  target_id: string;
  target_mime_type: string;
  target_resource_key: string;
} | null {
  if (!details) {
    return null;
  }

  return {
    target_id: details.targetId ?? "",
    target_mime_type: details.targetMimeType ?? "",
    target_resource_key: details.targetResourceKey ?? "",
  };
}

export function mapDriveFile(file: RawDriveFile): {
  created_time: string;
  description: string;
  drive_id: string;
  folder_color_rgb: string;
  icon_link: string;
  id: string;
  mime_type: string;
  modified_time: string;
  name: string;
  owned_by_me: boolean;
  owners: Array<{
    display_name: string;
    email_address: string;
    me: boolean;
    permission_id: string;
    photo_link: string;
  }>;
  parents: string[];
  resource_key: string;
  shared: boolean;
  shortcut_details: {
    target_id: string;
    target_mime_type: string;
    target_resource_key: string;
  } | null;
  size: string;
  starred: boolean;
  thumbnail_link: string;
  trashed: boolean;
  web_view_link: string;
} {
  return {
    created_time: file.createdTime ?? "",
    description: file.description ?? "",
    drive_id: file.driveId ?? "",
    folder_color_rgb: file.folderColorRgb ?? "",
    icon_link: file.iconLink ?? "",
    id: file.id ?? "",
    mime_type: file.mimeType ?? "",
    modified_time: file.modifiedTime ?? "",
    name: file.name ?? "",
    owned_by_me: file.ownedByMe ?? false,
    owners: (file.owners ?? []).map((owner) => mapDriveUser(owner)),
    parents: [...(file.parents ?? [])],
    resource_key: file.resourceKey ?? "",
    shared: file.shared ?? false,
    shortcut_details: mapShortcutDetails(file.shortcutDetails),
    size: file.size ?? "",
    starred: file.starred ?? false,
    thumbnail_link: file.thumbnailLink ?? "",
    trashed: file.trashed ?? false,
    web_view_link: file.webViewLink ?? "",
  };
}

export function createDriveFileList(options: {
  corpora: "allDrives" | "domain" | "drive" | "user";
  driveId?: string;
  includeItemsFromAllDrives: boolean;
  includeTrashed: boolean;
  maxResults: number;
  orderBy: string;
  query: string;
  rawFiles: RawDriveFile[];
  incompleteSearch?: boolean;
  nextPageToken?: string;
}): {
  corpora: "allDrives" | "domain" | "drive" | "user";
  count: number;
  drive_id: string;
  files: Array<ReturnType<typeof mapDriveFile>>;
  include_items_from_all_drives: boolean;
  include_trashed: boolean;
  incomplete_search: boolean;
  max_results: number;
  next_page_token: string;
  order_by: string;
  query: string;
} {
  const files = options.rawFiles.map((file) => mapDriveFile(file));

  return {
    corpora: options.corpora,
    count: files.length,
    drive_id: options.driveId ?? "",
    files,
    include_items_from_all_drives: options.includeItemsFromAllDrives,
    include_trashed: options.includeTrashed,
    incomplete_search: options.incompleteSearch ?? false,
    max_results: options.maxResults,
    next_page_token: options.nextPageToken ?? "",
    order_by: options.orderBy,
    query: options.query,
  };
}

export function mapDriveAbout(about: RawDriveAbout): {
  storage_quota: {
    limit: string;
    usage: string;
    usage_in_drive: string;
    usage_in_drive_trash: string;
  };
  user: {
    display_name: string;
    email_address: string;
    me: boolean;
    permission_id: string;
    photo_link: string;
  };
} {
  return {
    storage_quota: mapDriveStorageQuota(about.storageQuota),
    user: mapDriveUser(about.user),
  };
}
