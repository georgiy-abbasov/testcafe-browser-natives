import Promise from 'promise';
import OS from 'os-family';
import exists from '../utils/fs-exists-promised';
import { exec } from '../utils/exec';
import ALIASES from '../aliases';


// Installation info cache
var installationsCache = null;


// Find installations for different platforms
async function addInstallation (installations, name, instPath) {
    var fileExists = await exists(instPath);

    if (fileExists) {
        Object.keys(ALIASES).some(alias => {
            var { nameRe, cmd, macOpenCmdTemplate, path } = ALIASES[alias];

            if (nameRe.test(name)) {
                installations[alias] = { path: path || instPath, cmd, macOpenCmdTemplate };
                return true;
            }

            return false;
        });
    }
}

async function detectMicrosoftEdge () {
    var regKey = 'HKCU\\Software\\Classes\\ActivatableClasses';
    var stdout = await exec(`chcp 65001 | reg query ${regKey} /s /f MicrosoftEdge /k && echo SUCCESS || echo FAIL`);

    return /SUCCESS/.test(stdout) ? ALIASES['edge'] : null;
}

async function findWindowsBrowsers () {
    var installations = {};
    var regKey        = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\';
    var regKeyEsc     = regKey.replace(/\\/g, '\\\\');
    var browserRe     = new RegExp(regKeyEsc + '([^\\\\]+)\\\\shell\\\\open\\\\command' +
                                   '\\s+\\([^)]+\\)\\s+reg_sz\\s+([^\n]+)\n', 'gi');

    // NOTE: we should change code page to get correct result regardless the Windows localization.
    // Then we should restore it to avoid the terminal errors.
    var stdout       = await exec('chcp');
    var origCodePage = stdout.match(/\d{1,5}/)[0];

    stdout = await exec(`chcp 65001 | reg query ${regKey} /s`);

    for (var match = browserRe.exec(stdout); match; match = browserRe.exec(stdout)) {
        var name = match[1].replace(/\.exe$/gi, '');

        var path = match[2]
            .replace(/"/g, '')
            .replace(/\\$/, '')
            .replace(/\s*$/, '');

        await addInstallation(installations, name, path);
    }

    var edgeAlias = await detectMicrosoftEdge();

    if (edgeAlias)
        installations['edge'] = edgeAlias;

    await exec(`chcp ${origCodePage}`);

    return installations;
}

async function findMacBrowsers () {
    var installations = {};

    //NOTE: replace space symbol with the code, because grep splits strings by space.
    var stdout = await exec('ls "/Applications/" | grep -E "Chrome|Firefox|Opera|Safari|Chromium" | sed -E "s/ /032/"');

    await Promise.all(stdout
        .split('\n')
        .filter(fileName => !!fileName)
        .map(fileName => {
            //NOTE: restore space
            fileName = fileName.replace(/032/g, ' ');

            var name = fileName.replace(/.app$/, '');
            var path = `/Applications/${fileName}`;

            return addInstallation(installations, name, path);
        }));

    return installations;
}

async function findLinuxBrowsers () {
    var installations = {};
    var stdout        = await exec('update-alternatives --list x-www-browser');

    await Promise.all(stdout
        .split('\n')
        .map(path => {
            var name = path.replace(/.*\/([^\/]+)$/g, '$1');

            return addInstallation(installations, name, path);
        }));

    return installations;
}

async function findBrowsers () {
    if (OS.win)
        return await findWindowsBrowsers();

    if (OS.mac)
        return await findMacBrowsers();

    if (OS.linux)
        return await findLinuxBrowsers();
}


// API
/** @typedef {Object} BrowserInfo
 * @description Object that contains information about the browser installed on the machine.
 * @property {string|undefined} path - The path to the executable file that starts the browser.
 *  Required on MacOS machines. On Windows machines, it is used when the winOpenCmdTemplate property is undefined.
 * @property {string} cmd - Additional command line parameters.
 * @property {string} macOpenCmdTemplate - A [Mustache template](https://github.com/janl/mustache.js#templates)
 *  that provides parameters for launching the browser on a MacOS machine.
 * @property {string|undefined} winOpenCmdTemplate - A [Mustache template](https://github.com/janl/mustache.js#templates)
 *  that provides parameters for launching the browser on a Windows machine.  If undefined, the path to the
 *  executable file specified by the path property is used.
 * @example
 *  {
 *       path: 'C:\\ProgramFiles\\...\\firefox.exe',
 *       cmd: '-new-window',
 *       macOpenCmdTemplate: 'open -a "{{{path}}}" {{{pageUrl}}} --args {{{cmd}}}'
 *  }
 */

/**
 * Returns the list of the {@link BrowserInfo} objects that contain information about the browsers installed on the machine.
 * @function
 * @async
 * @name getInstallations
 * @returns {Object.<string, BrowserInfo>} List of the {@link BrowserInfo} objects
 *   containing information about the browsers installed on the machine.
 * @example
 * {
 *   chrome: {
 *       path: 'C:\\ProgramFiles\\...\\chrome.exe',
 *       cmd: '--new-window',
 *       macOpenCmdTemplate: 'open -n -a "{{{path}}}" --args {{{pageUrl}}} {{{cmd}}}'
 *   },
 *
 *   firefox: {
 *       path: 'C:\\ProgramFiles\\...\\firefox.exe',
 *       cmd: '-new-window',
 *       macOpenCmdTemplate: 'open -a "{{{path}}}" {{{pageUrl}}} --args {{{cmd}}}'
 *   }
 * }
 */
export default async function () {
    if (!installationsCache)
        installationsCache = await findBrowsers();

    return installationsCache;
}
