import { SetMetadata } from '@nestjs/common';

export const REQUIRE_LOGIN_KEY = 'require-login';

export const RequireLogin = (require = true) => SetMetadata(REQUIRE_LOGIN_KEY, require);
