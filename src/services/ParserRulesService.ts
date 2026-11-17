import ParserRulesRepository from '../data_layer/ParserRulesRepository';

class ParserRulesService {
  constructor(private readonly repository: ParserRulesRepository) {}

  createRule(id: string, owner: string, payload: { [key: string]: string }) {
    return this.repository.create(id, owner, payload);
  }

  findForOwner(owner: string, id: string) {
    return this.repository.findForOwner(owner, id);
  }

  deleteRule(id: string, owner: string): Promise<number> {
    return this.repository.deleteByObjectId(id, owner);
  }
}

export default ParserRulesService;
