import { describe, it, expect } from 'vitest';
import { parseGitRemote } from '../gitlab-remote';

describe('parseGitRemote', () => {
  it('parses scp-style SSH remotes with subgroups', () => {
    expect(parseGitRemote('git@gitlab.com:zuru.tech/apps/showroom/proj.git')).toEqual({
      host: 'gitlab.com',
      projectPath: 'zuru.tech/apps/showroom/proj',
    });
  });

  it('parses HTTPS remotes', () => {
    expect(parseGitRemote('https://gitlab.com/group/proj.git')).toEqual({
      host: 'gitlab.com',
      projectPath: 'group/proj',
    });
  });

  it('strips credentials from HTTPS remotes', () => {
    expect(parseGitRemote('https://oauth2:TOKEN@gitlab.example.com/grp/sub/proj.git')).toEqual({
      host: 'gitlab.example.com',
      projectPath: 'grp/sub/proj',
    });
  });

  it('parses ssh:// URL remotes with a port', () => {
    expect(parseGitRemote('ssh://git@gitlab.com:22/group/proj.git')).toEqual({
      host: 'gitlab.com',
      projectPath: 'group/proj',
    });
  });

  it('tolerates a missing .git suffix and trailing slash', () => {
    expect(parseGitRemote('https://gitlab.com/group/proj')).toEqual({ host: 'gitlab.com', projectPath: 'group/proj' });
    expect(parseGitRemote('git@gitlab.com:group/proj/')).toEqual({ host: 'gitlab.com', projectPath: 'group/proj' });
  });

  it('supports self-managed hosts', () => {
    expect(parseGitRemote('git@gitlab.internal.corp:team/repo.git')).toEqual({
      host: 'gitlab.internal.corp',
      projectPath: 'team/repo',
    });
  });

  it('returns null for non-remotes and paths without a namespace', () => {
    expect(parseGitRemote('')).toBeNull();
    expect(parseGitRemote('   ')).toBeNull();
    expect(parseGitRemote('not a url')).toBeNull();
    expect(parseGitRemote(42 as unknown)).toBeNull();
    // A path with no group (single segment) is not a valid group/project.
    expect(parseGitRemote('https://gitlab.com/justone')).toBeNull();
  });
});
