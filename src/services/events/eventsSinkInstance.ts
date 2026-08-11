import { EventsSink } from './EventsSink';
import { EventsRepository } from '../../data_layer/EventsRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import { getDatabase } from '../../data_layer';

let sink: EventsSink | null = null;

export const getEventsSink = (): EventsSink => {
  if (sink == null) {
    const usersRepository = new UsersRepository(getDatabase());
    sink = new EventsSink(new EventsRepository(getDatabase()), {
      signupOriginResolver: (userIds) =>
        usersRepository.getSignupOriginsByIds(userIds),
    });
    sink.start();
  }
  return sink;
};

export const resetEventsSinkForTesting = () => {
  sink?.stop();
  sink = null;
};
