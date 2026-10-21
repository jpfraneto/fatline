import { parseAbi } from 'viem';

export const voicesAbi = parseAbi([
  'event Voice(uint256 indexed id, address indexed author, uint256 indexed parentId, uint256 fid, string text)',
  'event Retracted(uint256 indexed id, address indexed author)',
  'function say(string text, uint256 parentId, uint256 fid) returns (uint256)',
  'function retract(uint256 id)',
  'function count() view returns (uint256)',
]);
