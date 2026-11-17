import { Request, Response } from 'express';

import ParserRulesService from '../services/ParserRulesService';
import { StoredParserRules } from '../data_layer/ParserRulesRepository';
import ParserRules from '../lib/parser/ParserRules';
import { getOwner } from '../lib/User/getOwner';

interface RuleResponse {
  flashcard_is: string;
  deck_is: string;
  sub_deck_is: string;
  tags_is: string;
  email_notification: boolean;
}

const toRuleResponse = (rule: StoredParserRules): RuleResponse => ({
  flashcard_is: rule.flashcard_is,
  deck_is: rule.deck_is,
  sub_deck_is: rule.sub_deck_is,
  tags_is: rule.tags_is,
  email_notification: Boolean(rule.email_notification),
});

const toTypeList = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
    : [];

const flashcardTypesError = (payload: unknown): string | null => {
  const types = toTypeList(
    (payload as { FLASHCARD?: unknown } | undefined)?.FLASHCARD
  );
  if (types.length === 0) {
    return 'Choose at least one block type to turn into flashcards.';
  }
  const supported = types.every((type) =>
    ParserRules.FLASHCARD_TYPE_ALLOWLIST.includes(type)
  );
  return supported ? null : 'One or more flashcard types are not supported.';
};

class RulesController {
  constructor(private readonly service: ParserRulesService) {}

  async createRule(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send();
    }

    const payload = req.body?.payload;
    const validationError = flashcardTypesError(payload);
    if (validationError != null) {
      return res.status(400).json({ message: validationError });
    }

    try {
      await this.service.createRule(id, getOwner(res), payload);
      res.status(201).json({ message: 'Rule created' });
    } catch (error) {
      console.info('Create rule failed');
      console.error(error);
      res.status(400).send();
    }
  }

  async findRule(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send();
    }

    try {
      const rule = await this.service.findForOwner(getOwner(res), id);
      if (rule == null) {
        res.status(200).json();
        return;
      }
      res.status(200).json(toRuleResponse(rule));
    } catch (err) {
      console.info('Get rule failed');
      console.error(err);
      res.status(200).json();
    }
  }

  async deleteRule(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).send();
    }

    await this.service.deleteRule(id, getOwner(res));
    res.status(204).send();
  }
}

export default RulesController;
