import { TFile } from 'obsidian';

export interface CreateTaskButtonSettings {
	tasksFolderPath: string; // Legacy field for backward compatibility
	createTaskFolderPath: string; // Path for creating new tasks
	calendarFolderPath: string; // Path for loading tasks in calendar
	language: 'ru' | 'en';
	showCompletedTasks: boolean; // Show/hide completed tasks in calendar
	autoOpenCalendar: boolean; // Automatically open calendar view on app startup
	closeOtherTabs: boolean; // Close other tabs when calendar is opened (only works if autoOpenCalendar is enabled)
}

export const DEFAULT_SETTINGS: CreateTaskButtonSettings = {
	tasksFolderPath: '', // Legacy
	createTaskFolderPath: '',
	calendarFolderPath: '',
	language: 'en',
	showCompletedTasks: true,
	autoOpenCalendar: false,
	closeOtherTabs: false
};

export interface Task {
	text: string;
	date: Date | null;
	file: TFile;
	line: number;
	isCompleted: boolean;
}

