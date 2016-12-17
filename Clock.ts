import Heap = require('heap');

interface Schedulable {
  targetTime: number;
  callback: () => void;
}

export class Clock {
  _time: number;
  // Schedulables are sorted by `targetTime`.
  _scheduleables: Heap<Schedulable>;

  constructor() {
    this._time = 0;
    this._scheduleables = new Heap(
      (a: Schedulable, b: Schedulable) => a.targetTime - b.targetTime,
    );
  }

  advance(offset: number): void {
    const endTime = this._time + offset;
    while (true) {
      const schedulable = this._scheduleables.pop();
      if (schedulable == null) {
        break;
      }
      if (schedulable.targetTime >= endTime) {
        this._scheduleables.push(schedulable);
        break;
      }
      this._time = schedulable.targetTime;
      // NB: `schedule()` can be called from this cb.
      schedulable.callback();
    }
    this._time = endTime;
  }

  schedule(fromNow: number, callback: () => void): void {
    this._scheduleables.push({
      targetTime: this._time + fromNow,
      callback,
    });
  }
}