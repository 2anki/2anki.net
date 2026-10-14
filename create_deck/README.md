# create_deck

This module is responsible for creating Anki flashcards for 2anki.net.
You can report issues in the [server](https://github.com/2anki/server/issues) repository.

## Dependencies

This project requires Python 3.10+ and the following main dependencies:
- `anki` - Anki's own library; every `.apkg` is built in a throwaway collection and exported the way Anki desktop exports
- `pydantic` - Data validation and settings management
- `ftfy` - Text encoding fixes for proper Unicode handling
- `pylint` - Code linting (development)
- `pytest` - Testing framework (development)
- `mock` - Testing utilities (development)

Install all dependencies with exact versions:
```bash
pip install -r requirements.txt
```

## API

The current implementation is CLI driven. [create_deck](./create_deck.py) is to
be executed with two arguments: absolute path to a JSON payload and template
directory. Note that the working directory has to be the workspace directory (
location of payload).

Here is an example execution

```bash
$ cd /tmp/w/9dOax-Y1fhrsmZxPad5g5
$ ./create_deck.py \
    /tmp/w/9dOax-Y1fhrsmZxPad5g5/deck_info.json
    /Users/scanf/src/github.com/2anki/server/src/templates/
```

Here is the workspace directory (stripped long filenames)
As you can see above there are also media files in here. The APKG file is
created based on the contents of deck_info.json.

```
/tmp/w/9dOax-Y1fhrsmZxPad5g5
├── [...].png
├── [...].apkg
├── [...].jpg
├── [...].png
├── [...].jpg
└── deck_info.json
```

### Template Options

The application supports several template options that can be specified in the `settings.template` field:

- `specialstyle` (default) - Uses custom.css styling
- `nostyle` - No additional styling
- `abhiyan` - Abhiyan template with custom front/back layouts
- `alex_deluxe` - Alex Deluxe template with custom styling
- `custom` - User-provided custom templates via n2aBasic, n2aCloze, n2aInput settings

Each template can have different styling and HTML layouts for basic, cloze, and input card types.

### JSON Structure

Inside the deck_info.json is an array of decks.

#### Deck

The deck object consists of settings (object), name (string), cards (array),
image (string), style (string):
https://github.com/2anki/server/blob/main/src/lib/parser/Deck.ts

```typescript
class Deck {
  name: string;
  cards: Note[];
  image: string | undefined;
  style: string | null;
  id: number;
  settings: Settings | null;
}
```

#### Note

The note type here is not exactly the same as in Anki. It is a mix between
flashcards, notes and other 2anki implementation details. create_deck will use
this structure to generate the flashcards.

https://github.com/2anki/server/blob/main/src/lib/parser/Note.ts

```typescript
class Note {
  name: string;
  back: string;
  tags: string[];
  cloze = false;
  number = 0;
  enableInput = false;
  answer = '';
  media: string[] = [];
  notionId?: string;
  notionLink?: string;
}
```

#### Settings

One of the powerful things with 2anki is the flexibility it provides. With the
settings users can make new rules for what a flashcard is.

https://github.com/2anki/server/blob/main/src/lib/parser/Settings.ts

```typescript
interface TemplateFile {
  parent: string;
  name: string;
  front: string;
  back: string;
  styling: string;
  storageKey: string;
}

export default class Settings {
  readonly deckName: string | undefined;
  readonly useInput: boolean;
  readonly maxOne: boolean;
  readonly noUnderline: boolean;
  readonly isCherry: boolean;
  readonly isAvocado: boolean;
  readonly isAll: boolean;
  readonly fontSize: string;
  readonly isTextOnlyBack: boolean;
  readonly toggleMode: string;
  readonly isCloze: boolean;
  readonly useTags: boolean;
  readonly basicReversed: boolean;
  readonly reversed: boolean;
  readonly removeMP3Links: boolean;
  readonly clozeModelName: string;
  readonly basicModelName: string;
  readonly inputModelName: string;
  readonly clozeModelId: string;
  readonly basicModelId: string;
  readonly inputModelId: string;
  readonly template: string;
  readonly perserveNewLines: boolean;
  readonly n2aCloze: TemplateFile | undefined;
  readonly n2aBasic: TemplateFile | undefined;
  readonly n2aInput: TemplateFile | undefined;
  readonly useNotionId: boolean;
  readonly addNotionLink: boolean;
  readonly pageEmoji: string;
  parentBlockId: string;
}
```

## Error Handling

The application includes production-ready error handling:
- Automatic error email alerts in production environments
- Comprehensive error logging with stack traces
- Graceful handling of encoding issues and malformed data
- Safe processing of surrogate characters in text fields
```

## Testing

The project includes a test suite using pytest:

```bash
# Run all tests
npm run test

# Or use pytest directly
pytest tests/
```

Test files include:
- `tests/test_cards.py` - Tests for card processing and encoding
- `tests/test_write_apkg.py` - Tests for APKG file creation
- `helpers/test_*.py` - Unit tests for helper modules

## Architecture

The codebase is organized into several modules:

- `create_deck.py` - Main entry point and orchestration
- `helpers/` - Utility modules for specific functionality:
  - `cards.py` - Card processing and text encoding
  - `write_apkg.py` - APKG file generation
  - `get_model*.py` - Anki model management
  - `sanitize_tags.py` - Tag processing
  - `read_template.py` - Template file handling
- `backend/utils/` - Backend utilities (email alerts)
- `tests/` - Test suite
- `fixtures/` - Test data and examples

## Docker Support

**Note**: The current Dockerfile references a `main.py` file that doesn't exist, suggesting incomplete HTTP API implementation. The Docker configuration needs to be updated to match the current CLI-based architecture.

## Roadmap

### Completed
- ✅ Production error handling and logging
- ✅ Multiple template support
- ✅ Comprehensive test suite
- ✅ Modular architecture with helper modules

### Near future
- Refactor the code base to use Python best practices
- Fix Docker configuration for proper containerization
- Complete HTTP API implementation

### Later
- Image Occlusion support
- Introduce progress/estimates on conversion jobs
- Read directly from 2anki database
- Optimize deck creation for large payloads and media files
