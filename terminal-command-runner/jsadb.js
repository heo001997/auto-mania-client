/*
///////////////////////////////////////////////////////////////

     ██╗███████╗       █████╗ ██████╗ ██████╗ 
     ██║██╔════╝      ██╔══██╗██╔══██╗██╔══██╗
     ██║███████╗█████╗███████║██║  ██║██████╔╝
██   ██║╚════██║╚════╝██╔══██║██║  ██║██╔══██╗
╚█████╔╝███████║      ██║  ██║██████╔╝██████╔╝
 ╚════╝ ╚══════╝      ╚═╝  ╚═╝╚═════╝ ╚═════╝ 
                                            
A JavaScript android device bridge controller API!
Developed by Matheus Ibrahim (Matth33w) - 2023
///////////////////////////////////////////////////////////////
*/

const { exec } = require("child_process");
const fs = require("fs");
const readline = require("readline");
const { DOMParser } = require('xmldom');
const charEvents = require('./char-events.json').char_events;

class JSADB {
    constructor() {
        this.errorHandler = this.errorHandler.bind(this);
    }

    errorHandler({code, message}) {
        return new Error(`An error occurred during execution.\nSTATUS: ${code}\n\nError Message:\n${message}`);
    }

    executeAdbCommand(command, device = '') {
        return new Promise((resolve, reject) => {
            const deviceFlag = device ? `-s ${device}` : '';
            exec(`adb ${deviceFlag} ${command}`, (error, stdout, stderr) => {
                if (error) {
                    reject(this.errorHandler(error));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    tap(x, y, device) {
        return this.executeAdbCommand(`shell input tap ${x} ${y}`, device);
    }

    swipe(xPoint1, yPoint1, xPoint2, yPoint2, durationInMs, device) {
        return this.executeAdbCommand(`shell input swipe ${xPoint1} ${yPoint1} ${xPoint2} ${yPoint2} ${durationInMs}`, device);
    }

    async type(text, device) {
        // Decode the URL-encoded text
        let decodedText = decodeURIComponent(text);
        decodedText = decodedText.replace(/"/g, '\\"'); // Escape double quotes

        // Split text into chunks that can be typed normally vs special characters
        let chunks = [];
        let currentText = '';

        for (let i = 0; i < decodedText.length; i++) {
            const char = decodedText[i];
            
            // Handle special characters that need keyevents
            if (char === '\n') {
                if (currentText) {
                    chunks.push({ type: 'text', content: currentText });
                    currentText = '';
                }
                chunks.push({ type: 'keyevent', content: 'KEYCODE_ENTER' });
            } else if (char === ' ') {
                if (currentText) {
                    chunks.push({ type: 'text', content: currentText });
                    currentText = '';
                }
                chunks.push({ type: 'keyevent', content: 'KEYCODE_SPACE' });
            } else {
                currentText += char;
            }
        }

        // Add any remaining text
        if (currentText) {
            chunks.push({ type: 'text', content: currentText });
        }

        // Execute each chunk in sequence
        for (const chunk of chunks) {
            if (chunk.type === 'text') {
                await this.executeAdbCommand(`shell input text "${chunk.content}"`, device);
            } else if (chunk.type === 'keyevent') {
                await this.executeAdbCommand(`shell input keyevent ${chunk.content}`, device);
            }
        }

        return Promise.resolve();
    }

    screenshot(device) {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
            const filename = `${device}_${timestamp}.png`;
            this.executeAdbCommand(`shell screencap -p /sdcard/${filename} && adb -s ${device} pull /sdcard/${filename}`, device)
                .then(() => {
                    fs.readFile(filename, (err, data) => {
                        if (err) {
                            reject(this.errorHandler({code: -1, message: "Failed to read screenshot file"}));
                        } else {
                            const base64Image = data.toString('base64');
                            fs.unlink(filename, (err) => {
                                if (err) console.error("Failed to delete screenshot file:", err);
                            });
                            resolve(base64Image);
                        }
                    });
                })
                .catch(reject);
        });
    }

    dumpWindowXML(device) {
        return new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
            const filename = `window_dump_${device}_${timestamp}.xml`;
            this.executeAdbCommand(`shell uiautomator dump /sdcard/${filename} && adb pull /sdcard/${filename}`, device)
                .then(() => {
                    fs.readFile(filename, 'utf8', (err, data) => {
                        if (err) {
                            reject(this.errorHandler({code: -1, message: "Failed to read window dump file"}));
                        } else {
                            fs.unlink(filename, (err) => {
                                if (err) console.error("Failed to delete window dump file:", err);
                            });
                            resolve(data);
                        }
                    });
                })
                .catch(reject);
        });
    }

    existsInDump(query, prop) {
        return new Promise(async (resolve, reject) => {
            if(!fs.existsSync(__dirname + "/window_dump.xml")) {
                reject(this.errorHandler({code: -1, message: "You need to dump the XML before making a query on it."}));
            } else {
                const rl = readline.createInterface(fs.createReadStream(__dirname + "/window_dump.xml"));
                let text = "";
                
                rl.on("line", textStream => {
                    text += textStream;
                });

                rl.on("close", () => {
                    resolve(text.indexOf(prop ? `${prop}="${query}"` : `text="${query}"`) > -1 ? true : false);
                });
            }
        });
    }

    async getResolution(device) {
        const output = await this.executeAdbCommand('shell wm size', device);
        const [width, height] = output.substring(15).trim().split('x').map(Number);
        return { width, height };
    }

    async getDeviceList() {
        const output = await this.executeAdbCommand('devices');
        return output.split('\n')
            .slice(1)
            .map(line => line.split('\t')[0])
            .filter(device => device.trim() !== '');
    }

    async listOfInstalledApps(device, includeSystemApps = false) {
        const command = includeSystemApps
            ? 'shell pm list packages'
            : 'shell pm list packages -3';
        const output = await this.executeAdbCommand(command, device);
        return output.replace(/\r/g, '').replace(/package:/g, '').split('\n').filter(Boolean);
    }

    appExists(appPackageName, device) {
        return new Promise(async (resolve, reject) => {
            try {
                const installedApps = await this.listOfInstalledApps(device ? device : undefined);

                if(appPackageName.trim() == "") {
                    reject(this.errorHandler({code: -1, message: "The app package name is mandatory."}));
                }

                if(installedApps.indexOf(appPackageName) > -1) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            } catch(err) {
                reject(err);
            }
        });
    }

    clearAppCache(appPackageName, device) {
        return this.executeAdbCommand(`shell pm clear ${appPackageName}`, device);
    }

    openApp(appPackageName, device) {
        return this.executeAdbCommand(`shell monkey -p ${appPackageName} 1`, device);
    }

    installApp(appPath, device) {
        return this.executeAdbCommand(`install ${appPath}`, device);
    }

    goToHome(device) {
        return this.executeAdbCommand('shell input keyevent KEYCODE_HOME', device);
    }

    async connectDevice(device) {
        const output = await this.executeAdbCommand(`connect ${device}`);
        return output.includes('connected');
    }

    waitInMilliseconds(time) {
        return new Promise(resolve => setTimeout(resolve, time));
    }

    getBatteryDetails(device) {
        return new Promise((resolve, reject) => {
            exec(`adb ${device ? `-s ${device}` : ""} shell dumpsys battery`, (error, stdout, stderr) => {
                if(error) {
                    reject(this.errorHandler(error));
                } else {
                    const textLines = stdout.replace(/\r/g, "").split("\n");
                    let finalObject = {};

                    for(var i = 1; i < textLines.length; i++) {
                        if(textLines[i].trim() != "") {
                            const currentTextLine = textLines[i].replace(/\s\s/g, "");
                            const propAndValueSeparator = currentTextLine.split(":");

                            let prop = propAndValueSeparator[0];
                            let value = propAndValueSeparator[1].substring(1, propAndValueSeparator[1].length);

                            switch(prop) {
                                case "AC powered": {
                                    prop = "acPowered";
                                    break;
                                }

                                case "USB powered": {
                                    prop = "usbPowered";
                                    break;
                                }

                                case "Wireless powered": {
                                    prop = "wirelessPowered";
                                    break;
                                }

                                case "Max charging current": {
                                    prop = "maxChargingCurrent";
                                    break;
                                }

                                case "Max charging voltage": {
                                    prop = "maxChargingVoltage";
                                    break;
                                }

                                case "Charge counter": {
                                    prop = "chargeCounter";
                                    break;
                                }
                            }

                            if(!isNaN(value)) {
                                value = Number(value);
                            }

                            if(value == "true" || value == "false") {
                                value = Boolean(value);
                            }

                            finalObject[prop] = value;
                        }
                    }
                    resolve(finalObject);
                }
            });
        });
    }

    async serviceCheck(service, device) {
        const output = await this.executeAdbCommand(`shell service check ${service}`, device);
        return !output.includes('not found');
    }

    findNodeAtCoordinate(x, y, xmlData) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlData, "text/xml");

        const parseNode = (node) => {
            if (node.nodeType !== 1) return null; // 1 is ELEMENT_NODE

            const bounds = node.attributes.getNamedItem('bounds');
            if (bounds) {
                const [left, top, right, bottom] = bounds.value.match(/\d+/g).map(Number);
                if (x >= left && x <= right && y >= top && y <= bottom) {
                    let bestMatch = null;
                    for (let i = 0; i < node.childNodes.length; i++) {
                        const childMatch = parseNode(node.childNodes[i]);
                        if (childMatch) bestMatch = childMatch;
                    }
                    return bestMatch || node;
                }
            }

            // If this node doesn't have bounds, check its children
            for (let i = 0; i < node.childNodes.length; i++) {
                const childMatch = parseNode(node.childNodes[i]);
                if (childMatch) return childMatch;
            }

            return null;
        };

        const result = parseNode(xmlDoc.documentElement);
        if (result) {
            const attributes = {};
            for (let i = 0; i < result.attributes.length; i++) {
                const attr = result.attributes[i];
                attributes[attr.name] = attr.value;
            }
            attributes.xpath = this.generateXPath(result);
            return attributes;
        }
        return null;
    }

    generateXPath(node) {
        const parts = [];
        while (node && node.nodeType === 1) { // 1 is ELEMENT_NODE
            let sibling = node;
            let count = 1;
            while (sibling = sibling.previousSibling) {
                if (sibling.nodeType === 1 && sibling.nodeName === node.nodeName) {
                    count++;
                }
            }
            const xpathPart = count > 1 ? 
                `${node.nodeName.toLowerCase()}[${count}]` : 
                node.nodeName.toLowerCase();
            parts.unshift(xpathPart);
            node = node.parentNode;
        }
        return `/${parts.join('/')}`;
    }

    async findNodeAtCoordinateFromDump(x, y, device) {
        const xmlData = await this.dumpWindowXML(device);
        
        // // Save XML data to a file
        // const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
        // const filename = `window_dump_${device}_${timestamp}.xml`;
        // await fs.promises.writeFile(filename, xmlData);
        
        // console.log(`XML data saved to ${filename}`);

        return this.findNodeAtCoordinate(x, y, xmlData);
    }

    async findNodeByXPath(xpath, device) {
        const xmlData = await this.dumpWindowXML(device);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlData, "text/xml");

        const select = require('xpath').select;
        const nodes = select(xpath, xmlDoc);

        if (nodes.length > 0) {
            const node = nodes[0];
            const attributes = {};
            for (let i = 0; i < node.attributes.length; i++) {
                const attr = node.attributes[i];
                attributes[attr.name] = attr.value;
            }
            attributes.xpath = xpath;
            return attributes;
        }
        return null;
    }

    async getCurrentInputText(device) {
        const xmlData = await this.dumpWindowXML(device);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlData, "text/xml");

        const select = require('xpath').select;
        const editTextNodes = select("//node[@class='android.widget.EditText']", xmlDoc);

        if (editTextNodes.length > 0) {
            const focusedNode = editTextNodes.find(node => node.getAttribute('focused') === 'true');
            if (focusedNode) {
                const text = focusedNode.getAttribute('text');
                const contentDesc = focusedNode.getAttribute('content-desc');
                const hint = focusedNode.getAttribute('hint');
                
                // Check if the text is not empty and different from hint (if available)
                if (text && text !== hint && text !== contentDesc) {
                    return text;
                }
                
                // If text is empty or same as hint, the input is likely empty
                return '';
            }
        }

        return '';
    }

    async clearCurrentInput(device, currentText = null) {
        try {
            // Get current input text if not provided
            if (currentText === null || currentText === undefined || currentText === "") {
                currentText = await this.getCurrentInputText(device);
            }
            
            if (!currentText) {
                return "Input is already empty";
            }

            // Calculate number of delete key events needed (add some extra for safety)
            const deleteCount = currentText.length + 10;

            // Move to the end of the input and send multiple delete key events in a single command
            const deleteCommand = `input keyevent KEYCODE_MOVE_END ${Array(deleteCount).fill('KEYCODE_DEL').join(' ')}`;
            await this.executeAdbCommand(`shell ${deleteCommand}`, device);

            return "Input cleared successfully";
        } catch (error) {
            throw new Error(`Failed to clear input: ${error.message}`);
        }
    }

    screenAwake(device) {
        return this.executeAdbCommand('shell svc power stayon usb', device);
    }

    screenAwakeOff(device) {
        return this.executeAdbCommand('shell svc power stayon false', device);
    }
}

module.exports = JSADB;
module.exports = JSADB;