import { MemoryController } from './MemoryController';

type RtcState = 'awaiting_0' | 'awaiting_1';

interface Rtc {
  state: RtcState;
  seconds: number;
  minutes: number;
  hours: number;
  dl: number;
  dh: number;
}

export class Mbc3 extends MemoryController {
  _ramEnabled: boolean;
  _selectedRomBank: number;
  _selectedRamBank: number;
  _rtc: Rtc;

  constructor() {
    super();
    this._ramEnabled = false;
    this._selectedRomBank = 0x1;
    this._selectedRamBank = 0x0;
    this._rtc = {
      state: 'awaiting_0',
      seconds: 0,
      minutes: 0,
      hours: 0,
      dl: 0,
      dh: 0,
    };
  }

  enableRam(data: number): void {
    if ((data & 0xF) === 0x0A) {
      this._ramEnabled = true;
    } else {
      this._ramEnabled = false;
    }
  }

  selectRomBank(data: number): void {
    let bank = data & 0x7F;
    if (bank === 0x0) {
      this._selectedRomBank = 0x1;
    } else {
      this._selectedRomBank = bank;
    }
  }

  selectRamBank(data: number): void {
    if (
      0x0 <= data && data < 0x4 // Ram banks.
      || 0x8 <= data && data <= 0xC // RTC registers.
    ) {
      this._selectedRamBank = data;
    } else {
      throw new Error(`Invalid ram bank: ${data}`);
    }
  }

  latchClockData(data: number): void {
    if (data === 0x0 && this._rtc.state === 'awaiting_0') {
      this._rtc.state = 'awaiting_1';
    } else if (data === 0x1 && this._rtc.state === 'awaiting_1') {
      this._rtc.state = 'awaiting_0';
      // TODO write out clock values to the buffer.
    }
  }
}