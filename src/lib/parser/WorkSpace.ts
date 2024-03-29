import path from 'path';
import fs from 'fs';
import { getRandomUUID } from '../../shared/helpers/getRandomUUID';

class Workspace {
  location: string;

  id: string;

  constructor(isNew: boolean, type: string) {
    if (isNew && type === 'fs') {
      this.id = getRandomUUID();
      this.location = path.join(process.env.WORKSPACE_BASE!, this.id);
    } else {
      throw new Error(`unsupported ${type}`);
    }
    this.ensureExists();
  }

  private ensureExists() {
    if (!fs.existsSync(this.location)) {
      fs.mkdirSync(this.location, { recursive: true });
    }
  }
}

export default Workspace;
