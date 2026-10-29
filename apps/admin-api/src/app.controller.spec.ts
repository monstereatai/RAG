import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  it('returns health status', () => {
    expect(controller.health()).toMatchObject({
      status: 'ok',
      service: 'admin-backend',
    });
  });
});
