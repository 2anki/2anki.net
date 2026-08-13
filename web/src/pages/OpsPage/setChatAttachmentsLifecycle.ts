export interface SetChatAttachmentsLifecycleResponse {
  ruleId: string;
  ruleCount: number;
}

export async function setChatAttachmentsLifecycle(): Promise<SetChatAttachmentsLifecycleResponse> {
  const response = await fetch('/api/ops/chat-attachments-lifecycle', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
