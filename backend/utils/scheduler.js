const Task = require('../models/Task');
const Device = require('../models/Device');

const startScheduler = (mqttClient) => {
    setInterval(async () => {
        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ":" + 
                            now.getMinutes().toString().padStart(2, '0');
        const currentDay = now.getDay();

        try {
            // Find enabled tasks that should turn ON now
            const onTasks = await Task.find({ onTime: currentTime, days: currentDay, isEnabled: true });
            onTasks.forEach(task => executeScheduledTask(task, true, mqttClient));

            // Find enabled tasks that should turn OFF now
            const offTasks = await Task.find({ offTime: currentTime, days: currentDay, isEnabled: true });
            offTasks.forEach(task => executeScheduledTask(task, false, mqttClient));
        } catch (err) { 
            console.error("Scheduler Error:", err); 
        }
    }, 60000); // Check every minute
};

async function executeScheduledTask(task, state, mqttClient) {
    try {
        const device = await Device.findOne({ deviceId: task.deviceId });
        if (!device) return;

        const sw = device.switches.find(s => s.id === task.switchId);
        if (!sw) return;

        // Apply logic inversion for hardware signal
        const hardwareSignal = sw.inverted ? !state : state;
        mqttClient.publish(`devices/${task.deviceId}/command`, JSON.stringify({ 
            switchId: task.switchId, 
            state: hardwareSignal 
        }));

        // Update Database State
        await Device.updateOne(
            { deviceId: task.deviceId, "switches.id": task.switchId },
            { $set: { "switches.$.state": state, "switches.$.lastOnTime": state ? new Date() : null } }
        );
        console.log(`[SCHEDULE] Executed ${state ? 'ON' : 'OFF'} for ${task.deviceId}`);
    } catch (err) {
        console.error(`[SCHEDULE ERROR] ${task.deviceId}:`, err.message);
    }
}

module.exports = startScheduler;