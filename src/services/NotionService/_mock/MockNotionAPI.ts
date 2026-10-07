import {
  GetBlockResponse,
  GetPageResponse,
  ListBlockChildrenResponse,
  QueryDataSourceResponse,
} from '@notionhq/client/build/src/api-endpoints';
import NotionAPIWrapper, { GetBlockParams } from '../NotionAPIWrapper';
import dataMockPath from './helpers/dataMockPath';
import { mockDataExists } from './helpers/mockDataExists';
import getPayload from './helpers/getPayload';

function refuseLiveCall(type: string, id: string): never {
  throw new Error(
    `MockNotionAPI: no recorded ${type} fixture for '${id}'; refusing to reach the live Notion API from a test. Record the fixture offline and commit it under _mock/payloads.`
  );
}

export default class MockNotionAPI extends NotionAPIWrapper {
  async getBlocks({ id }: GetBlockParams): Promise<ListBlockChildrenResponse> {
    if (mockDataExists('ListBlockChildrenResponse', id)) {
      return getPayload(
        dataMockPath('ListBlockChildrenResponse', id)
      ) as ListBlockChildrenResponse;
    }
    refuseLiveCall('ListBlockChildrenResponse', id);
  }

  async getPage(id: string): Promise<GetPageResponse | null> {
    if (mockDataExists('GetPageResponse', id)) {
      return getPayload(dataMockPath('GetPageResponse', id)) as GetPageResponse;
    }
    refuseLiveCall('GetPageResponse', id);
  }

  async getBlock(id: string): Promise<GetBlockResponse> {
    if (mockDataExists('GetBlockResponse', id)) {
      return getPayload(
        dataMockPath('GetBlockResponse', id)
      ) as GetBlockResponse;
    }
    refuseLiveCall('GetBlockResponse', id);
  }

  async queryDatabase(id: string): Promise<QueryDataSourceResponse> {
    if (mockDataExists('QueryDataSourceResponse', id)) {
      return getPayload(
        dataMockPath('QueryDataSourceResponse', id)
      ) as QueryDataSourceResponse;
    }
    refuseLiveCall('QueryDataSourceResponse', id);
  }
}
