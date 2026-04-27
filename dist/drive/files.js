"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapDriveFile = mapDriveFile;
exports.createDriveFileList = createDriveFileList;
exports.mapDriveAbout = mapDriveAbout;
function mapDriveUser(user) {
    return {
        display_name: user?.displayName ?? "",
        email_address: user?.emailAddress ?? "",
        me: user?.me ?? false,
        permission_id: user?.permissionId ?? "",
        photo_link: user?.photoLink ?? "",
    };
}
function mapDriveStorageQuota(quota) {
    return {
        limit: quota?.limit ?? "",
        usage: quota?.usage ?? "",
        usage_in_drive: quota?.usageInDrive ?? "",
        usage_in_drive_trash: quota?.usageInDriveTrash ?? "",
    };
}
function mapShortcutDetails(details) {
    if (!details) {
        return null;
    }
    return {
        target_id: details.targetId ?? "",
        target_mime_type: details.targetMimeType ?? "",
        target_resource_key: details.targetResourceKey ?? "",
    };
}
function mapDriveFile(file) {
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
function createDriveFileList(options) {
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
function mapDriveAbout(about) {
    return {
        storage_quota: mapDriveStorageQuota(about.storageQuota),
        user: mapDriveUser(about.user),
    };
}
