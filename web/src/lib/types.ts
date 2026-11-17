export interface Settings {
  object_id: string;
  title?: string | null;
  payload: { [key: string]: string };
}

export interface Rules {
  flashcard_is: string;
  deck_is: string;
  sub_deck_is: string;
  tags_is: string;
  email_notification: boolean;
}

export type SettingsPayload = { [key: string]: string };
