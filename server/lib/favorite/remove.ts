import DB from '../storage/db';

export default function remove(id: string, owner: number) {
  return DB('favorite').delete().where({
    object_id: id,
    owner,
  });
}
