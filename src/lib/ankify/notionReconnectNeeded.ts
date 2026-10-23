// Stored as an Ankify subscription's last_error when Notion rejects the
// connection. The sync is paused, the page offers Reconnect, and saving a new
// Notion token resumes exactly the subscriptions marked this way.
export const NOTION_RECONNECT_NEEDED = 'notion_reconnect_needed';
