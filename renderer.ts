import * as fs from 'fs';
import {Memory} from './Memory.js';
import {Cpu} from './Cpu.js';
import {Clock} from './Clock.js';

const rom = fs.readFileSync(__dirname + '/../pokemonblue.gb');
const memory = new Memory(rom);
const clock = new Clock();
const cpu = new Cpu(clock, memory);
while (true) {
  cpu.next();
}