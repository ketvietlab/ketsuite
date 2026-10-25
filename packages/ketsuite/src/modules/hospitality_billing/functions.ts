import { functions as accountingFunctions } from './functions/accounting.ts'
import { chargeRuleCommands } from './functions/charge-rule-record.ts'
import { financialCommands } from './functions/financial-commands.ts'
export const functions = chargeRuleCommands(financialCommands(accountingFunctions))
