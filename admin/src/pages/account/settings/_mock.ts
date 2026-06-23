import type { Request, Response } from 'express';
import { defaultUser } from '../../../../mock/utils';

function getCurrentUse(_req: Request, res: Response) {
  return res.json({
    data: defaultUser,
  });
}

export default {
  'GET  /api/accountSettingCurrentUser': getCurrentUse,
};
