// An encrypted attachment dedicated to the group avatar uses this reserved filename.
export const GROUP_AVATAR_FILE = 'axonic-group-avatar-v1';

export function isGroupAvatarFile(file?: {name: string; mime?: string}) {
 return file?.name === GROUP_AVATAR_FILE && file.mime?.startsWith('image/') === true;
}
