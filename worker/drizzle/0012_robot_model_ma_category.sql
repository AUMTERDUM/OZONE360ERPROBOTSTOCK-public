-- Which MA checklist a robot model uses: 'delivery' | 'industrial' | 'cleaning'.
-- NULL means the app guesses from the model name.
ALTER TABLE `RobotModel` ADD COLUMN `maCategory` text;
