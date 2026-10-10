export type AttachmentPreviewDraft={uri:string;name:string;mime:string;size?:number;caption?:string};
export type ConfirmAttachment=(drafts:AttachmentPreviewDraft[])=>Promise<AttachmentPreviewDraft[]|null>;
