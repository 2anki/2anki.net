interface UserUpload {
  id: string;
  size_mb: number;
  owner: number;
  key: string;
  filename: string;
  object_id: string;
  created_at: string | null;
  source: string | null;
  dropped_image_count: number | null;
  image_drop_reason: string | null;
}

export default UserUpload;
